"""Generate Phrase Bank install icons from the approved app-icon master."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "docs" / "design-references" / "phrase-bank-app-icon-master.png"
OUTPUT_DIR = ROOT / "public" / "icons"
ICON_SIZES = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-maskable-512.png": 512,
}


def generate_icons() -> None:
    """Write opaque, square PNG icons using high-quality downsampling."""
    with Image.open(MASTER) as source:
        if source.width != source.height:
            raise ValueError(f"Icon master must be square, got {source.size}")

        # The approved master already has a full-bleed forest-green field and
        # keeps the central P inside the maskable 80% safe region. Resizing the
        # complete frame preserves that treatment without an inset seam.
        master = source.convert("RGB")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        for filename, size in ICON_SIZES.items():
            icon = master.resize((size, size), Image.Resampling.LANCZOS)
            icon.save(OUTPUT_DIR / filename, format="PNG", optimize=True)


if __name__ == "__main__":
    generate_icons()
