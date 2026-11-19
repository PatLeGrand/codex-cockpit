import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('native_prepare', Path(__file__).resolve().parents[1] / 'scripts/prepare-native.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(file, entries):
    tree = {'files': {}}
    offset = 0
    for name, data in entries.items():
        node = tree
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'].setdefault(part, {'files': {}})
        node['files'][parts[-1]] = {'offset': str(offset), 'size': len(data)}
        offset += len(data)
    data = json.dumps(tree, separators=(',', ':')).encode()
    padded = data + b'\0' * (-len(data) % 4)
    header = struct.pack('<II', len(padded) + 4, len(data)) + padded
    file.write_bytes(struct.pack('<II', 4, len(header)) + header + b''.join(entries.values()))


class NativePrepareTests(unittest.TestCase):
    def test_round_trip_updates_offsets_and_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.asar'
            output = Path(directory) / 'patched.asar'
            fixture(source, {'package.json': b'{}', 'nested/main.js': b'old', 'last.txt': b'keep me'})
            original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            original = module.Asar(source)
            original.rebuild(output, {'nested/main.js': b'new data is longer'})
            changed = module.Asar(output)
            self.assertEqual(changed.read('last.txt'), b'keep me')
            self.assertEqual(changed.read('nested/main.js'), b'new data is longer')
            self.assertEqual(changed.node('nested/main.js')['integrity']['hash'], hashlib.sha256(b'new data is longer').hexdigest())
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original_hash)

    def test_unsupported_versions_fail_before_creating_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'application'
            (source / 'resources').mkdir(parents=True)
            fixture(source / 'resources/app.asar', {'package.json': b'{"version":"unrecognized"}'})
            destination = root / 'copy'
            with self.assertRaisesRegex(ValueError, 'Unsupported Codex version'):
                module.prepare(source, destination)
            self.assertFalse(destination.exists())

    def test_existing_destination_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'existing'; target.mkdir()
            (target / 'important').write_text('preserve')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                module.prepare('/missing', target)
            self.assertEqual((target / 'important').read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
