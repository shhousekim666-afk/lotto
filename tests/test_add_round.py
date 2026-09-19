import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("add_round", ROOT / "add_round.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AddRoundTest(unittest.TestCase):
    def test_validation_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            html = Path(directory) / "index.html"
            original = 'const RAW = [[1,"2002-12-07",1,2,3,4,5,6,7]];'
            html.write_text(original)
            with patch.object(module, "HTML", html):
                for value in ["3,2002-12-14,1,2,3,4,5,6,7", "2,2002-12-15,1,2,3,4,5,6,7", "2,2002-12-14,1,1,3,4,5,6,7", "1,2002-12-07,1,2,3,4,5,6,8"]:
                    with patch("sys.argv", ["add_round.py", value]):
                        with self.assertRaises(ValueError):
                            module.main()
                    self.assertEqual(html.read_text(), original)
                with patch("sys.argv", ["add_round.py", "2,2002-12-14,8,9,10,11,12,13,14"]):
                    module.main()
                    once = html.read_text()
                    module.main()
                    self.assertEqual(html.read_text(), once)
                    rows = json.loads(once.split("=", 1)[1].strip().rstrip(";"))
                    self.assertEqual(len(rows), 2)


if __name__ == "__main__":
    unittest.main()
