import { Config } from "@remotion/cli/config";

// Defaults only. engine/render.py passes explicit flags per machine (encoder,
// pipeline, concurrency), so anything set here is the fallback for manual runs.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
