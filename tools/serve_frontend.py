from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class ControlLabRequestHandler(SimpleHTTPRequestHandler):
    """Serve built assets and fall back to index.html for client-side routes."""

    def serve_app_shell(self):  # type: ignore[no-untyped-def]
        index_path = Path(self.directory) / "index.html"
        try:
            app_shell = index_path.open("rb")
        except OSError:
            self.send_error(404, "Frontend build is missing")
            return None

        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(index_path.stat().st_size))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            return app_shell
        except BaseException:
            app_shell.close()
            raise

    def send_head(self):  # type: ignore[no-untyped-def]
        request_path = urlsplit(self.path).path
        translated_path = Path(self.translate_path(request_path))
        is_client_route = not Path(request_path).suffix

        # Always return a fresh app shell for browser navigations. Reusing
        # SimpleHTTPRequestHandler's conditional response for /experiments
        # could produce a 304 for /index.html and leave Ctrl+R on stale state.
        if request_path in {"/", "/index.html"}:
            return self.serve_app_shell()
        if is_client_route and not translated_path.exists():
            return self.serve_app_shell()

        return super().send_head()

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browsers routinely cancel obsolete asset requests during reloads.
            # This is not a server failure and should not frighten the user with
            # a full traceback in the launcher window.
            return


class ControlLabHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Control Lab production frontend.")
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()

    directory = args.directory.expanduser().resolve()
    index_path = directory / "index.html"
    if not index_path.is_file():
        raise SystemExit(f"Frontend build is missing: {index_path}")

    handler = lambda *handler_args, **handler_kwargs: ControlLabRequestHandler(  # noqa: E731
        *handler_args,
        directory=str(directory),
        **handler_kwargs,
    )
    server = ControlLabHTTPServer((args.host, args.port), handler)

    print(f"Serving Control Lab at http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nFrontend server stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
