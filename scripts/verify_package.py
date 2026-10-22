"""Inspect the local IPK without running application or TV code."""
import hashlib
import io
import json
import pathlib
import tarfile

root = pathlib.Path(__file__).resolve().parent.parent
expected = json.loads((root / 'appinfo.json').read_text(encoding='utf-8'))
package = root / 'artifacts' / (expected['id'] + '_' + expected['version'] + '_all.ipk')
raw = package.read_bytes()
assert raw[:8] == b'!<arch>\n', 'Not an ar/IPK archive'
parts = {}
offset = 8
while offset < len(raw):
    header = raw[offset:offset + 60]
    assert len(header) == 60 and header[58:60] == b'`\n'
    name = header[:16].decode('ascii').strip().rstrip('/')
    length = int(header[48:58].decode('ascii'))
    parts[name] = raw[offset + 60:offset + 60 + length]
    offset += 60 + length + (length % 2)

assert parts['debian-binary'].strip() == b'2.0'
with tarfile.open(fileobj=io.BytesIO(parts['data.tar.gz']), mode='r:gz') as archive:
    assert all(member.isdir() or member.isfile() for member in archive.getmembers()), 'Links or special files are not allowed'
    members = [member for member in archive.getmembers() if member.isfile()]
    assert members and min(member.mtime for member in members) > 946684800, 'Epoch timestamps are unsuitable for webOS 5'
    names = [member.name for member in members]
    assert not any('node_modules' in name or 'sdk-source' in name or 'lg-sdk.zip' in name for name in names)
    assert any(name.endswith('/vendor/webOSTV.js') for name in names)
    manifest = next(member for member in members if member.name.endswith('/appinfo.json'))
    info = json.load(archive.extractfile(manifest))
    assert info['id'] == expected['id'] and info['version'] == expected['version']
    app_prefix = 'usr/palm/applications/' + info['id'] + '/'
    service_id = info['id'] + '.lights'
    service_prefix = 'usr/palm/services/' + service_id + '/'
    service_files = {'api.js', 'controller.js', 'protocol.js', 'service.js', 'transport.js', 'package.json', 'services.json',
                     'hyperhdr-rpc.js', 'piccap-probe.js', 'piccap-lifecycle.js', 'screen-backend.js', 'screen-control.js', 'screen-session.js',
                     'screen-settings.js', 'screen-store.js', 'home-autostart.sh', 'home-input.js', 'home-watch.js', 'home-power.js'}
    if (root / 'services' / service_id / 'screen-config.json').is_file():
        service_files.add('screen-config.json')
    checked_app = set()
    checked_service = set()
    for member in members:
        if member.name == 'usr/palm/packages/com.frxn.mipantalla/packageinfo.json':
            metadata = json.load(archive.extractfile(member))
            assert metadata['id'] == info['id'] and metadata['version'] == info['version']
            continue
        if member.name.startswith(app_prefix):
            relative = member.name[len(app_prefix):]
            assert '..' not in pathlib.PurePosixPath(relative).parts
            local = root / 'dist' / relative
            checked_app.add(relative)
        elif member.name.startswith(service_prefix):
            relative = member.name[len(service_prefix):]
            assert relative in service_files, 'Unexpected service file: ' + relative
            local = root / 'services' / service_id / relative
            checked_service.add(relative)
        else:
            raise AssertionError('Unexpected package path: ' + member.name)
        assert local.is_file(), 'Unexpected file: ' + member.name
        assert archive.extractfile(member).read() == local.read_bytes(), 'Package differs from build: ' + relative
    assert checked_app == {str(p.relative_to(root / 'dist')).replace('\\', '/') for p in (root / 'dist').rglob('*') if p.is_file()}, 'Missing app files'
    if (root / 'dist' / 'lights-client.js').is_file():
        assert checked_service == service_files, 'Missing WiZ service files'
print(json.dumps({'package': package.name, 'bytes': len(raw), 'files': len(members), 'sha256': hashlib.sha256(raw).hexdigest(), 'matches_dist': True}))
