from __future__ import annotations

import functools
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from serve_frontend import ControlLabHTTPServer, ControlLabRequestHandler


class FrontendServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        (root / "assets").mkdir()
        (root / "index.html").write_text("<main>Control Lab</main>", encoding="utf-8")
        (root / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")

        handler = functools.partial(ControlLabRequestHandler, directory=str(root))
        self.server = ControlLabHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def test_client_route_ignores_conditional_cache_and_returns_app_shell(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/experiments",
            headers={
                "If-Modified-Since": "Wed, 31 Dec 2099 23:59:59 GMT",
            },
        )
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertEqual(response.read(), b"<main>Control Lab</main>")

    def test_missing_asset_stays_404_instead_of_returning_html(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/assets/missing.js",
            headers={"Accept": "application/javascript"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request)
        self.assertEqual(context.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
