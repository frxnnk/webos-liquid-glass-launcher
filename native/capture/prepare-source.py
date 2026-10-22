#!/usr/bin/env python3
"""Apply the pinned patch and stamp only an explicit disposable build source copy."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    if source == (HERE / "upstream").resolve():
        raise SystemExit("Refusing to alter the immutable upstream snapshot")
    manifest = json.loads((HERE / "manifest.json").read_text())
    patch = (HERE / "patches/0001-single-owner.patch").read_bytes()
    if sha(patch) != manifest["patchSha256"]:
        raise SystemExit("Patch fingerprint mismatch")
    contents = {}
    for name, pins in manifest["files"].items():
        contents[name] = (source / name).read_bytes().replace(b"\r\n", b"\n")
        if sha(contents[name]) not in (pins["upstreamSha256"], pins["patchedSha256"]):
            raise SystemExit("Source fingerprint mismatch: " + name)
    original = all(sha(contents[n]) == p["upstreamSha256"] for n, p in manifest["files"].items())
    applied = all(sha(contents[n]) == p["patchedSha256"] for n, p in manifest["files"].items())
    if not original and not applied:
        raise SystemExit("Partially changed source; inspect before continuing")
    generator = source / "GenerateVersionHeader.cmake"
    version = manifest["version"]
    stamp = ('set(HYPERION_WEBOS_VERSION "' + version + '")\nconfigure_file(${SRC} ${DST} @ONLY)\n').encode()
    previous = generator.read_bytes().replace(b"\r\n", b"\n")
    if sha(previous) != manifest["versionGeneratorSha256"] and previous != stamp:
        raise SystemExit("Version generator fingerprint mismatch")
    if original:
        for name, data in contents.items():
            (source / name).write_bytes(data)
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "-d", str(source)],
                       input=patch, check=True, timeout=5, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for name, pins in manifest["files"].items():
        if sha((source / name).read_bytes()) != pins["patchedSha256"]:
            raise SystemExit("Patched fingerprint mismatch: " + name)
    generator.write_bytes(stamp)
    print(json.dumps({"prepared": True, "upstream": manifest["upstreamCommit"],
                      "patchSha256": manifest["patchSha256"], "version": version}))


if __name__ == "__main__":
    main()
