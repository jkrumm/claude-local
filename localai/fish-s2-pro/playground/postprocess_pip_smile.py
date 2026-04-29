"""Apply the production smile EQ post-process to each pip_cut_smile_de matrix entry.

For every `matrix_<script>__pip_cut_smile_de.wav`, generates:
  *_eq.wav  → smile EQ chain applied to output (production pipeline)

The +5% atempo variant was tested and dropped — locked production output is
raw Fish synthesis + smile EQ filter, no speedup. Run after
pregenerate_via_server.py finishes.
"""

from __future__ import annotations

import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT / "samples"

VOICE = "pip_cut_smile_de"

# Same EQ chain we used on the reference clip.
SMILE_EQ_CHAIN = (
    "highpass=f=70,"
    "equalizer=f=600:t=q:w=2.5:g=-3,"
    "equalizer=f=5500:t=q:w=2.5:g=3,"
    "equalizer=f=12000:t=q:w=2:g=1.5,"
    "loudnorm=I=-18:TP=-2:LRA=7"
)

VARIANTS = {
    "eq": SMILE_EQ_CHAIN,
}


def run_ffmpeg(in_path: Path, out_path: Path, af: str) -> None:
    cmd = [
        "ffmpeg", "-y", "-i", str(in_path),
        "-af", af,
        "-ar", "44100",  # loudnorm upsamples internally to 192k — force back to 44.1
        "-ac", "1",
        "-acodec", "pcm_s16le",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  FAIL: {res.stderr[-400:]}", file=sys.stderr)
    else:
        print(f"  ok → {out_path.name}")


def main() -> None:
    bases = sorted(SAMPLES_DIR.glob(f"matrix_*__{VOICE}.wav"))
    if not bases:
        print(f"no {VOICE} matrix entries found — run pregenerate first")
        sys.exit(1)

    print(f"processing {len(bases)} base entries × {len(VARIANTS)} variants = {len(bases) * len(VARIANTS)} files\n")

    for base in bases:
        print(f"[{base.stem}]")
        stem = base.stem  # matrix_<script>__pip_cut_smile_de
        for suffix, af in VARIANTS.items():
            out = SAMPLES_DIR / f"{stem}_{suffix}.wav"
            if out.exists():
                print(f"  cached: {out.name}")
                continue
            run_ffmpeg(base, out, af)
        print()


if __name__ == "__main__":
    main()
