"""Local dev server with correct MIME types for ES modules.

    python scripts/serve.py            # then open http://localhost:8765
"""

import functools
import http.server
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".html": "text/html",
        ".css": "text/css",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


print(f"Serving {root} at http://localhost:{port}")
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(root))).serve_forever()
