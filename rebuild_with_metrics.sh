#!/usr/bin/env bash
# ============================================================
# 为 llama.cpp 容器追加 --metrics 参数后重建的完整命令
# 每个容器下方分 3 步:
#   1. 查看当前容器参数确认 (docker inspect)
#   2. 停止并删除旧容器
#   3. 以相同参数+追加 --metrics 重建并启动容器
# ============================================================
# 注意: 请逐组手动执行，确保每一步没有报错后再继续下一个

# ============================================================
# 1. glm-cpu (Port 38092)
# ============================================================
echo ">>> [1/5] 当前 glm-cpu 参数:"
docker inspect glm-cpu --format '{{json .Config.Cmd}}' | python3 -m json.tool

echo ">>> 停止并删除 glm-cpu..."
docker stop glm-cpu && docker rm glm-cpu

echo ">>> 重建 glm-cpu (加入 --metrics)..."
docker run -d \
  --name glm-cpu \
  --restart unless-stopped \
  --ipc host \
  --security-opt label=disable \
  -v /data/models/GLM-4.7-Flash-GGUF:/models \
  -p 38092:8080 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/GLM-4.7-Flash-Q4_K_M.gguf \
  -c 199608 \
  -b 8192 \
  --no-mmap \
  -ngl 0 \
  -t 16 \
  -tb 16 \
  -np 1 \
  --numa isolate \
  --cache-type-k q8_0 \
  --cache-type-v q4_0 \
  --host 0.0.0.0 \
  --port 8080 \
  --chat-template-kwargs '{"enable_thinking": false}' \
  --repeat-penalty 1.0 \
  --presence-penalty 1.5 \
  --min-p 0.01 \
  --top-p 1.0 \
  --temp 0.7 \
  --metrics

echo ">>> glm-cpu 重建完成! 验证 metrics:"
sleep 2 && curl -sf http://localhost:38092/metrics | head -5 && echo OK

echo ""
# ============================================================
# 2. gpt-cpu (Port 38094)
# ============================================================
echo ">>> [2/5] 当前 gpt-cpu 参数:"
docker inspect gpt-cpu --format '{{json .Config.Cmd}}' | python3 -m json.tool

echo ">>> 停止并删除 gpt-cpu..."
docker stop gpt-cpu && docker rm gpt-cpu

echo ">>> 重建 gpt-cpu (加入 --metrics)..."
docker run -d \
  --name gpt-cpu \
  --restart unless-stopped \
  --ipc host \
  --security-opt label=disable \
  -v /data/models/gpt-oss-20b-gguf:/models \
  -p 38094:8080 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/gpt-oss-20b-Q4_K_M.gguf \
  -c 131072 \
  -b 8192 \
  --cache-type-k q8_0 \
  --cache-type-v q4_0 \
  --no-mmap \
  -ngl 0 \
  -t 16 \
  -tb 16 \
  -np 1 \
  --numa isolate \
  --host 0.0.0.0 \
  --port 8080 \
  --repeat-penalty 1.0 \
  --presence-penalty 1.5 \
  --min-p 0.01 \
  --top-p 1.0 \
  --top-k 40 \
  --temp 1.0 \
  --metrics

echo ">>> gpt-cpu 重建完成! 验证 metrics:"
sleep 2 && curl -sf http://localhost:38094/metrics | head -5 && echo OK

echo ""
# ============================================================
# 3. gemma-cpu (Port 38093)
# ============================================================
echo ">>> [3/5] 当前 gemma-cpu 参数:"
docker inspect gemma-cpu --format '{{json .Config.Cmd}}' | python3 -m json.tool

echo ">>> 停止并删除 gemma-cpu..."
docker stop gemma-cpu && docker rm gemma-cpu

echo ">>> 重建 gemma-cpu (加入 --metrics)..."
docker run -d \
  --name gemma-cpu \
  --restart unless-stopped \
  --ipc host \
  --security-opt label=disable \
  -v /data/models/gemma-3-27b-it-GGUF:/models \
  -p 38093:8080 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/gemma-3-27b-it-Q4_K_M.gguf \
  -c 131072 \
  -b 8192 \
  --cache-type-k q8_0 \
  --cache-type-v q4_0 \
  --no-mmap \
  -ngl 0 \
  -t 16 \
  -tb 16 \
  -np 1 \
  --numa isolate \
  --host 0.0.0.0 \
  --port 8080 \
  --repeat-penalty 1.0 \
  --presence-penalty 1.5 \
  --min-p 0.01 \
  --top-p 0.95 \
  --top-k 64 \
  --temp 1.0 \
  --metrics

echo ">>> gemma-cpu 重建完成! 验证 metrics:"
sleep 2 && curl -sf http://localhost:38093/metrics | head -5 && echo OK

echo ""
# ============================================================
# 4. gemma3-1.58 (Port 38011)
# ============================================================
echo ">>> [4/5] 当前 gemma3-1.58 参数:"
docker inspect gemma3-1.58 --format '{{json .Config.Cmd}}' | python3 -m json.tool

echo ">>> 停止并删除 gemma3-1.58..."
docker stop gemma3-1.58 && docker rm gemma3-1.58

echo ">>> 重建 gemma3-1.58 (加入 --metrics, 修正 --top-p=0.95)..."
docker run -d \
  --name gemma3-1.58 \
  --restart unless-stopped \
  --ipc host \
  --security-opt label=disable \
  -v /data/models/unsloth-iq1/gemma-3-27b-it-GGUF:/models \
  -p 38011:8080 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/gemma-3-27b-it-UD-IQ1_M.gguf \
  -c 32768 \
  -b 8192 \
  --cache-type-k q8_0 \
  --cache-type-v q4_0 \
  --no-mmap \
  -ngl 0 \
  -t 16 \
  -tb 16 \
  -np 1 \
  --numa isolate \
  --host 0.0.0.0 \
  --port 8080 \
  --repeat-penalty 1.0 \
  --presence-penalty 1.5 \
  --min-p 0.01 \
  --top-p 0.95 \
  --top-k 64 \
  --temp 1.0 \
  --metrics

echo ">>> gemma3-1.58 重建完成! 验证 metrics:"
sleep 2 && curl -sf http://localhost:38011/metrics | head -5 && echo OK

echo ""
# ============================================================
# 5. qw3-1.58 (Port 38012)
# ============================================================
echo ">>> [5/5] 当前 qw3-1.58 参数:"
docker inspect qw3-1.58 --format '{{json .Config.Cmd}}' | python3 -m json.tool

echo ">>> 停止并删除 qw3-1.58..."
docker stop qw3-1.58 && docker rm qw3-1.58

echo ">>> 重建 qw3-1.58 (加入 --metrics)..."
docker run -d \
  --name qw3-1.58 \
  --restart unless-stopped \
  --ipc host \
  --security-opt label=disable \
  -v /data/models/unsloth-iq1/Qwen3-30B-A3B-Instruct-2507-GGUF:/models \
  -p 38012:8080 \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/Qwen3-30B-A3B-Instruct-2507-UD-IQ1_M.gguf \
  -c 32768 \
  -b 8192 \
  --cache-type-k q8_0 \
  --cache-type-v q4_0 \
  --no-mmap \
  -ngl 0 \
  -t 16 \
  -tb 16 \
  -np 1 \
  --numa isolate \
  --host 0.0.0.0 \
  --port 8080 \
  --repeat-penalty 1.0 \
  --presence-penalty 1.5 \
  --min-p 0.01 \
  --top-p 0.8 \
  --top-k 20 \
  --temp 0.7 \
  --metrics

echo ">>> qw3-1.58 重建完成! 验证 metrics:"
sleep 2 && curl -sf http://localhost:38012/metrics | head -5 && echo OK

echo ""
echo "======================================"
echo " 全部重建完成, 验证可以用:"
echo " curl http://localhost:38092/metrics | head -3  # glm-cpu"
echo " curl http://localhost:38094/metrics | head -3  # gpt-cpu"
echo " curl http://localhost:38093/metrics | head -3  # gemma-cpu"
echo " curl http://localhost:38011/metrics | head -3  # gemma3-1.58"
echo " curl http://localhost:38012/metrics | head -3  # qw3-1.58"
echo "======================================"
