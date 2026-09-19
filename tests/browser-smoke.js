import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadDraws } from '../backtest/data-loader.js';

const root=resolve('.');
const external=process.env.SITE_URL;
const server=createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!path.startsWith(root+'/')) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json'})[extname(path)]||'text/plain');
    res.end(await readFile(path));
  } catch {res.writeHead(404).end();}
});
if(!external) await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=external||`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true});
let fixture;
try {
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  async function checkBalls(){
    await page.waitForFunction(()=>document.querySelectorAll('#eBalls .e-ball:not(.ghost)').length===6);
    for(const id of ['freq','cooccur','monte','delta','genetic','hotcold']){
      const nums=await page.locator(`#br-${id} .ball`).allTextContents();
      assert.equal(new Set(nums).size,6);
      assert.ok(nums.every(n=>Number.isInteger(+n)&&+n>=1&&+n<=45));
    }
    await page.waitForFunction(()=>document.querySelectorAll('#utilityCard .ball').length===36);
    assert.equal(await page.locator('#bayesCard').count(),1);
    assert.equal(await page.locator('#bayesCard .utility-balls .ball').count(),6);
  }
  await page.goto(base);
  await checkBalls();
  await page.waitForFunction(()=>document.querySelectorAll('#btTableWrap tbody tr').length===6);
  // 난수 결과가 우연히 같아도 실패하지 않도록 DOM 갱신 자체를 관측한다.
  await page.evaluate(()=>{
    document.querySelector('#bayesCard').dataset.stale='yes';
    document.querySelector('#bayesCard .utility-balls').dataset.stale='yes';
    document.querySelector('#utilityCard .utility-result').dataset.stale='yes';
  });
  await page.getByRole('button',{name:'↻ 전체 재생성',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#bayesCard .utility-balls[data-stale]')&&!document.querySelector('#utilityCard .utility-result[data-stale]'));
  await checkBalls();
  assert.deepEqual(errors,[]);
  if(!external){
    const html=await readFile('index.html','utf8');
    // 실제 장애와 같은 통계 초기화 예외를 주입해 다른 추천이 살아 있는지 검사한다.
    await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:html.replace('function initStats(){','function initStats(){throw new Error("injected statistics failure");')}));
    await page.goto(base+'index.html');
    await checkBalls();
    assert.match(await page.locator('#appStatus').innerText(),/통계/);
    await page.unroute('**/index.html');
    errors.length=0;
    // 가상 다음 회차는 임시 복사본에만 추가한다. 실제 당첨 DB는 변경하지 않는다.
    fixture=await mkdtemp(join(tmpdir(),'lotto-weekly-test-'));
    await cp('index.html',join(fixture,'index.html'));
    await cp('add_round.py',join(fixture,'add_round.py'));
    const last=loadDraws().at(-1);
    const date=new Date(Date.parse(last.date)+7*86400000).toISOString().slice(0,10);
    execFileSync('python3',[join(fixture,'add_round.py'),`${last.no+1},${date},1,2,3,4,5,6,7`]);
    const updated=await readFile(join(fixture,'index.html'),'utf8');
    await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:updated}));
    await page.goto(base+'index.html');
    await checkBalls();
    await page.waitForFunction(()=>document.querySelector('#btMeta').textContent.includes('재계산이 필요'));
    assert.deepEqual(errors,[]);
    await page.unroute('**/index.html');
    await page.route('**/backtest/backtest-summary.json',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.goto(base);
    await checkBalls();
    await page.waitForFunction(()=>document.querySelector('#btTableWrap').textContent.includes('로드할 수 없습니다'));
  }
  console.log(`브라우저 검증 통과: ${external?'배포 사이트':'초기 표시·전체 재생성·통계 오류 격리·회차 추가·결과 로드 실패'}`);
} finally {
  await browser.close();
  if(!external) await new Promise(r=>server.close(r));
  if(fixture) await rm(fixture,{recursive:true,force:true});
}
