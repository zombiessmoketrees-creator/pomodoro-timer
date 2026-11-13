"""Runtime hardware detection: pick the fastest H.264 encoder this machine really has.

Windows gaming PC with an NVIDIA card  -> h264_nvenc
Apple Silicon MacBook                  -> h264_videotoolbox
Anything else / encoder unavailable    -> libx264 (software)

Each candidate is verified with a real one-second test encode, because FFmpeg
lists encoders it was compiled with even when the driver or GPU is missing.
"""
from __future__ import annotations

import platform
from dataclasses import asdict, dataclass, field
from functools import lru_cache

from common import capture, env, which

# Quality-targeted settings, roughly matched to libx264 CRF 18.
ENCODER_ARGS: dict[str, list[str]] = {
    "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "20", "-b:v", "0"],
    "h264_videotoolbox": ["-c:v", "h264_videotoolbox", "-q:v", "62", "-allow_sw", "1", "-realtime", "0"],
    "h264_qsv": ["-c:v", "h264_qsv", "-global_quality", "21", "-preset", "medium"],
    "h264_amf": ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "19", "-qp_p", "21"],
    "libx264": ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
}
COMMON_ARGS = ["-pix_fmt", "yuv420p", "-movflags", "+faststart"]


@dataclass(frozen=True)
class Hardware:
    os: str
    arch: str
    gpu: str
    encoder: str
    accelerated: bool
    tried: list[str] = field(default_factory=list)

    def ffmpeg_video_args(self) -> list[str]:
        return [*ENCODER_ARGS[self.encoder], *COMMON_ARGS]

    def as_dict(self) -> dict:
        return asdict(self)


def _gpu_name(system: str) -> str:
    nvidia_smi = which("nvidia-smi")
    if nvidia_smi:
        code, out = capture([nvidia_smi, "--query-gpu=name", "--format=csv,noheader"])
        if code == 0 and out.strip():
            return out.strip().splitlines()[0]
    if system == "Darwin":
        code, out = capture(["sysctl", "-n", "machdep.cpu.brand_string"])
        if code == 0 and out.strip():
            return out.strip()
    if system == "Windows":
        code, out = capture(
            ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name -join '; '"]
        )
        if code == 0 and out.strip():
            return out.strip()
    return "unknown"


def _encoder_works(encoder: str) -> bool:
    ffmpeg = which("ffmpeg")
    if not ffmpeg:
        return False
    code, _ = capture(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=1",
            *ENCODER_ARGS[encoder], "-pix_fmt", "yuv420p", "-f", "null", "-",
        ]
    )
    return code == 0


def _candidates(system: str, arch: str) -> list[str]:
    if system == "Darwin":
        return ["h264_videotoolbox", "libx264"]
    if system == "Windows":
        return ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
    return ["h264_nvenc", "h264_qsv", "libx264"]


@lru_cache(maxsize=None)
def detect(force: str = "") -> Hardware:
    """Detect the best working encoder. `force` (or VIDEO_ENCODER in .env) overrides."""
    system, arch = platform.system(), platform.machine().lower()
    gpu = _gpu_name(system)
    requested = (force or env("VIDEO_ENCODER", "auto")).lower()
    tried: list[str] = []

    if requested not in ("", "auto"):
        aliases = {"nvenc": "h264_nvenc", "videotoolbox": "h264_videotoolbox", "qsv": "h264_qsv",
                   "amf": "h264_amf", "x264": "libx264", "software": "libx264", "cpu": "libx264"}
        encoder = aliases.get(requested, requested)
        if encoder not in ENCODER_ARGS:
            raise SystemExit(f"[studio] ERROR: unknown encoder '{requested}'. Choose from: auto, {', '.join(ENCODER_ARGS)}")
        tried.append(encoder)
        if _encoder_works(encoder):
            return Hardware(system, arch, gpu, encoder, encoder != "libx264", tried)
        print(f"[studio] Requested encoder {encoder} failed its test encode; auto-detecting instead.")

    for encoder in _candidates(system, arch):
        if encoder in tried:
            continue
        tried.append(encoder)
        if encoder == "libx264" or _encoder_works(encoder):
            return Hardware(system, arch, gpu, encoder, encoder != "libx264", tried)
    return Hardware(system, arch, gpu, "libx264", False, tried)
