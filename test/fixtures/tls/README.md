# TLS test fixtures

For `test/system-ca.test.js`. Test-only; never trusted outside a test.

- `ca.pem` - a CA that no real certificate store contains
  (`CN=squally-mcp test CA - trusted by no real store`). Its private key was
  discarded after signing `server.pem`, so nothing else can ever be signed by it.
- `server.pem`, `server-key.pem` - the certificate and key of the local HTTPS
  server the tests start: `CN=localhost`, SAN `IP:127.0.0.1, DNS:localhost`,
  signed by `ca.pem`, valid until 2126.

A test hands `ca.pem` to the server as if the operating system's store held it
(the store itself cannot be changed from a test), and checks that the server is
reached only then.
