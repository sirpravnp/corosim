#!/usr/bin/env bash
# Reproduce the spike. Needs: git, cmake, ninja, python>=3.10 (emsdk), node>=18, network.
set -euo pipefail
cd "$(dirname "$0")"
[ -d vendor/svZeroDSolver ] || git clone https://github.com/SimVascular/svZeroDSolver.git vendor/svZeroDSolver
(cd vendor/svZeroDSolver && git checkout 8969093263fd5b47374e224c51b413a67dcb9945)
[ -d vendor/emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git vendor/emsdk
export EMSDK_PYTHON=${EMSDK_PYTHON:-python3.12}
(cd vendor/emsdk && ./emsdk install latest && ./emsdk activate latest)
source vendor/emsdk/emsdk_env.sh
# plain build, and SIMD+LTO build
emcmake cmake -S . -B build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-wasm
emcmake cmake -S . -B build-wasm-simd -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-msimd128 -flto -fno-math-errno" -DCMAKE_EXE_LINKER_FLAGS="-flto" && cmake --build build-wasm-simd
mkdir -p dist
cp build-wasm/svzerod_wasm.js dist/svzerod_wasm.js; cp build-wasm/svzerod_wasm.wasm dist/
cp build-wasm-simd/svzerod_wasm.js dist/svzerod_wasm_simd.js; cp build-wasm-simd/svzerod_wasm.wasm dist/svzerod_wasm_simd.wasm
sed -i.bak 's/svzerod_wasm\.wasm/svzerod_wasm_simd.wasm/g' dist/svzerod_wasm_simd.js && rm dist/*.bak
cp dist/svzerod_wasm.js dist/svzerod_wasm.cjs; cp dist/svzerod_wasm_simd.js dist/svzerod_wasm_simd.cjs   # node loads .cjs
# native reference build of the same shim
cmake -S . -B build-native -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-native
