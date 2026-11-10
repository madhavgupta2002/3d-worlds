#!/usr/bin/env python3
"""Loopback-only static server with caching disabled, so edits show up on reload.

Usage: python3 tools/devserver.py [port]
Binds 127.0.0.1 only — nothing outside this machine can reach it.
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".hdr": "image/vnd.radiance",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
    handler = functools.partial(Handler, directory=ROOT)
    with Server((HOST, port), handler) as httpd:
        print(f"Boating in Hyderabad -> http://{HOST}:{port}/   (loopback only)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
