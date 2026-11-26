#!/usr/bin/env bash
# Replace the scroll hero: bash tools/make-frames.sh path/to/new-video.mp4
# Makes 120 WebP frames (720px wide). Keep the video ~10s so scroll feels smooth.
set -e
rm -f public/frames240hd/*.webp
N=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$1")
STEP=$(( N / 120 )); [ $STEP -lt 1 ] && STEP=1
ffmpeg -v error -i "$1" -vf "select='not(mod(n,$STEP))',scale=720:-2" -vsync vfr -frames:v 120 -c:v libwebp -quality 68 public/frames240hd/f%03d.webp
cp public/frames240hd/f001.webp public/img/poster.webp
ls public/frames | wc -l
