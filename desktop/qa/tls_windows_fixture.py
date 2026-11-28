"""Controlled Windows HTTPS fixture for positive and negative chain validation."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'verified TLS fixture')


def exercise(old, new, out):
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        now = datetime.now(timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'ChipScreener ephemeral TLS test CA')])
        host = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])

        def certificate(subject, issuer, key):
            return (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(key.public_key())
                    .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1))
                    .not_valid_after(now + timedelta(days=1)))

        root = (certificate(ca, ca, ca_key).add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
                .sign(ca_key, hashes.SHA256()))
        leaf = (certificate(host, ca, leaf_key).add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
                .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]), False)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), False)
                .sign(ca_key, hashes.SHA256()))
        ca_file, pem, key_file = [folder / name for name in ('root.cer', 'leaf.pem', 'leaf.key')]
        ca_file.write_bytes(root.public_bytes(serialization.Encoding.DER))
        pem.write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        key_file.write_bytes(leaf_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ))
        server = HTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(pem, key_file)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_port
        url = f'https://localhost:{port}/'
        runner = Path(__file__).with_name('tls_probe.py')

        def probe(package, label, target, expected, native=False):
            resources = package / 'resources'
            subprocess.run([str(resources / 'runtime-python/python.exe'), '-B', str(runner),
                            str(resources / 'scripts'), str(out / f'{label}.json'),
                            *(['--native'] if native else []), '--local', target, expected], check=True, timeout=25)

        thumbprint = root.fingerprint(hashes.SHA1()).hex()
        try:
            probe(old, 'rc5-untrusted-issuer', url, 'failed')
            probe(new, 'repair-untrusted-issuer', url, 'failed', native=True)
            subprocess.run(['certutil', '-f', '-addstore', 'Root', str(ca_file)], check=True, timeout=25)
            probe(new, 'repair-windows-root', url, 'verified', native=True)
            probe(new, 'repair-wrong-hostname', f'https://127.0.0.1:{port}/', 'failed', native=True)
        finally:
            subprocess.run(['certutil', '-f', '-delstore', 'Root', thumbprint], check=False, timeout=25)
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == '__main__':
    exercise(*(Path(path).resolve() for path in sys.argv[1:]))
