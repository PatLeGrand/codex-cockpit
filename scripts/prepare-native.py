#!/usr/bin/env python3
"""Build a user-local Codex Linux copy; never edit the installed app."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
import tempfile

VERSION = '26.1027.30824'
BOOTSTRAP = '.vite/build/early-bootstrap.js'
COMPOSER = 'webview/assets/codex-composer-adapter-89c9b3bdd56a.js'
HASHES = {
    BOOTSTRAP: '0d20210cbefda34c7a5d09e520c758028245c0bf40a84321364e4f77b30e323c',
    COMPOSER: 'a868282da3e6dbdb0e8d34395206d9ee3499dfd1b27b6a6d02102ba1e8f1678e',
}


class Asar:
    def __init__(self, file):
        self.file = Path(file)
        with self.file.open('rb') as stream:
            prefix = stream.read(16)
            if len(prefix) != 16 or struct.unpack('<I', prefix[:4])[0] != 4:
                raise ValueError('Invalid ASAR prefix')
            header_size = struct.unpack('<I', prefix[4:8])[0]
            json_size = struct.unpack('<I', prefix[12:16])[0]
            if not 0 < json_size <= 32 * 1024 * 1024 or header_size < json_size + 8:
                raise ValueError('Invalid ASAR header size')
            self.tree = json.loads(stream.read(json_size))
            self.base = 8 + header_size

    def node(self, name):
        node = self.tree
        for part in name.split('/'):
            node = node['files'][part]
        return node

    def read(self, name):
        node = self.node(name)
        if node.get('unpacked') or 'offset' not in node:
            raise ValueError(f'Not an archived file: {name}')
        with self.file.open('rb') as stream:
            stream.seek(self.base + int(node['offset']))
            data = stream.read(node['size'])
        if len(data) != node['size']:
            raise ValueError('Truncated ASAR')
        return data

    def rebuild(self, destination, replacements):
        tree = copy.deepcopy(self.tree)
        archived = []

        def walk(node, prefix=''):
            for key, value in node.get('files', {}).items():
                name = prefix + key
                if 'files' in value:
                    walk(value, name + '/')
                elif 'offset' in value and not value.get('unpacked'):
                    archived.append((name, value, int(value['offset']), value['size']))
        walk(tree)
        if not set(replacements).issubset({item[0] for item in archived}):
            raise ValueError('Replacement not present in archive')
        archived.sort(key=lambda item: item[2])
        offset = 0
        for name, node, old_offset, old_size in archived:
            node['offset'] = str(offset)
            if name in replacements:
                data = replacements[name]
                node['size'] = len(data)
                size = node.get('integrity', {}).get('blockSize', 4194304)
                node['integrity'] = {
                    'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
                    'blockSize': size,
                    'blocks': [hashlib.sha256(data[i:i + size]).hexdigest() for i in range(0, len(data), size)],
                }
            offset += node['size']
        header_json = json.dumps(tree, separators=(',', ':'), ensure_ascii=False).encode()
        padded = header_json + b'\0' * (-len(header_json) % 4)
        header = struct.pack('<II', 4 + len(padded), len(header_json)) + padded
        with self.file.open('rb') as source, Path(destination).open('xb') as output:
            output.write(struct.pack('<II', 4, len(header)))
            output.write(header)
            for name, _node, old_offset, old_size in archived:
                if name in replacements:
                    output.write(replacements[name])
                else:
                    source.seek(self.base + old_offset)
                    remaining = old_size
                    while remaining:
                        chunk = source.read(min(remaining, 4 * 1024 * 1024))
                        if not chunk:
                            raise ValueError('Truncated archive while copying')
                        output.write(chunk)
                        remaining -= len(chunk)
        check = Asar(destination)
        for name, expected in replacements.items():
            if check.read(name) != expected:
                raise ValueError(f'Rebuilt archive failed verification: {name}')


def patches(archive):
    package = json.loads(archive.read('package.json'))
    if package.get('version') != VERSION:
        raise ValueError(f'Unsupported Codex version {package.get("version")}; supported: {VERSION}. No files changed.')
    source = {}
    for name, expected in HASHES.items():
        data = archive.read(name)
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f'Compatibility check failed for {name}. No files changed.')
        source[name] = data.decode()
    anchor = 'ji=n[255],ji}function Tr'
    if source[COMPOSER].count(anchor) != 1:
        raise ValueError('Composer adapter anchor is not unique')
    # U is this exact build's resolved local conversation ID. cloneElement ensures
    # it stays current even when React compiler reuses the cached root element.
    source[COMPOSER] = source[COMPOSER].replace(anchor, 'ji=n[255],(0,kr.cloneElement)(ji,{"data-cockpit-thread-id":U??""})}function Tr')
    bootstrap = 'try{require(require("node:path").join(process.resourcesPath,"codex-cockpit","host.cjs")).attach()}catch(error){console.error("[codex-cockpit] adapter unavailable",error.message)}\n'
    source[BOOTSTRAP] = bootstrap + source[BOOTSTRAP]
    return {name: text.encode() for name, text in source.items()}


def prepare(source, destination):
    source = Path(source).resolve()
    destination = Path(destination).absolute()
    if destination.exists():
        raise ValueError(f'Destination already exists: {destination}. Choose a new directory.')
    if destination.is_relative_to(source):
        raise ValueError('Destination must be outside the installed application directory')
    archive = Asar(source / 'resources/app.asar')
    replacements = patches(archive)  # Validate everything before creating output.
    repo = Path(__file__).resolve().parents[1]
    if not (source / 'ChatGPT').is_file():
        raise ValueError('Expected Linux ChatGPT executable')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.cockpit-prepare-', dir=destination.parent))
    try:
        for entry in source.iterdir():
            if entry.name in ('resources', 'ChatGPT', 'codex-launcher'):
                continue
            (staging / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
        # A real executable in this directory is necessary for process.resourcesPath.
        shutil.copy2(source / 'ChatGPT', staging / 'ChatGPT')
        resources = staging / 'resources'; resources.mkdir()
        for entry in (source / 'resources').iterdir():
            if entry.name != 'app.asar':
                (resources / entry.name).symlink_to(entry, target_is_directory=entry.is_dir())
        archive.rebuild(resources / 'app.asar', replacements)
        native = resources / 'codex-cockpit'; native.mkdir()
        for name in ('host.cjs', 'renderer.js', 'style.css'):
            shutil.copy2(repo / 'native' / name, native / name)
        shutil.copy2(repo / 'src/sessions.mjs', native / 'sessions.mjs')
        manifest = {'codexVersion': VERSION, 'cockpitVersion': json.loads((repo / 'package.json').read_text())['version'], 'source': str(source), 'mode': 'native-local-copy', 'sourceHashes': HASHES}
        (staging / 'cockpit-install.json').write_text(json.dumps(manifest, indent=2) + '\n')
        launcher = staging / 'launch-cockpit'
        shutil.copy2(repo / 'native/launch-cockpit', launcher)
        launcher.chmod(0o755)
        staging.rename(destination)
    except BaseException:
        shutil.rmtree(staging)
        raise
    return destination / 'launch-cockpit'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='/usr/lib/chatgpt', help='Installed Linux application directory')
    parser.add_argument('--destination', help='New directory for the local copy')
    parser.add_argument('--check', action='store_true', help='Validate compatibility without creating files')
    args = parser.parse_args()
    if not args.check and not args.destination:
        parser.error('--destination is required unless --check is used')
    try:
        if args.check:
            patches(Asar(Path(args.source) / 'resources/app.asar'))
            print(f'Compatible: Codex {VERSION}. Native composer adapter verified.')
        else:
            print(f'Prepared: {prepare(args.source, args.destination)}\nClose Codex, then run this launcher. Original installation untouched.')
    except (ValueError, OSError, KeyError) as error:
        print(f'Cockpit: {error}', file=sys.stderr)
        sys.exit(1)
