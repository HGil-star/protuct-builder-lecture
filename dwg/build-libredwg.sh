#!/usr/bin/env bash
# LibreDWG dwg2dxf를 WebAssembly로 빌드해 vendor/libredwg/에 복사합니다.
# 필요: Emscripten(emsdk) 환경이 활성화된 셸 (source emsdk_env.sh)
set -euo pipefail
VERSION=0.13.3
OUT="$(cd "$(dirname "$0")" && pwd)/vendor/libredwg"
WORK="$(mktemp -d)"
cd "$WORK"
curl -fsSL "https://ftp.gnu.org/gnu/libredwg/libredwg-$VERSION.tar.xz" | tar xJ
cd "libredwg-$VERSION"
emconfigure ./configure --disable-bindings --disable-docs --disable-shared --enable-static --disable-write --host=wasm32 CFLAGS=-O2
emmake make -j"$(nproc)" -C src
emmake make -C programs dwg2dxf
emcc -O2 programs/dwg2dxf.o src/.libs/libredwg.a -lm -o "$OUT/dwg2dxf.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sEXPORTED_RUNTIME_METHODS=FS,callMain -sFORCE_FILESYSTEM=1
echo "built $OUT/dwg2dxf.{mjs,wasm}"
