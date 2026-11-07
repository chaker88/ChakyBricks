import zipfile
from pathlib import Path


def build_wheel(
    folder: Path, name: str = "chakytiny", version: str = "1.0", requires: str | None = None
) -> Path:
    """A minimal pure-Python wheel so package installs can be tested offline."""
    folder.mkdir(parents=True, exist_ok=True)
    wheel = folder / f"{name}-{version}-py3-none-any.whl"
    dist_info = f"{name}-{version}.dist-info"
    files = {
        f"{name}/__init__.py": f"VALUE = 42\nVERSION = {version!r}\n",
        f"{dist_info}/METADATA": f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n"
        + (f"Requires-Dist: {requires}\n" if requires else ""),
        f"{dist_info}/WHEEL": (
            "Wheel-Version: 1.0\nGenerator: chakybricks-tests\n"
            "Root-Is-Purelib: true\nTag: py3-none-any\n"
        ),
    }
    record = "".join(f"{path},,\n" for path in files) + f"{dist_info}/RECORD,,\n"
    with zipfile.ZipFile(wheel, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
        archive.writestr(f"{dist_info}/RECORD", record)
    return wheel
