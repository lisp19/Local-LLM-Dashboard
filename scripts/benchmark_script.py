import time
import asyncio
import re
import os
import argparse
import json
import matplotlib.pyplot as plt
from matplotlib import gridspec
from openai import AsyncOpenAI

def parse_args():
    parser = argparse.ArgumentParser(description="vLLM/llama.cpp Concurrency Benchmark Script")
    parser.add_argument("--base-url", type=str, required=True, help="API Base URL")
    parser.add_argument("--api-key", type=str, default="vllm-test", help="API Key")
    parser.add_argument("--model-name", type=str, required=True, help="Model Name")
    parser.add_argument("--concurrency", type=int, default=1, help="Number of parallel requests")
    parser.add_argument("--prompts", type=str, help="JSON array of prompts")
    parser.add_argument("--output-dir", type=str, default=".", help="Directory to save plots")
    parser.add_argument("--cpu-info", type=str, default="Unknown CPU", help="CPU hardware info")
    parser.add_argument("--gpu-info", type=str, default="", help="GPU hardware info")
    parser.add_argument("--os-info", type=str, default="Linux", help="OS info")
    parser.add_argument("--runtime-type", type=str, default="cpu", choices=["nvidia", "amd", "cpu"], help="GPU runtime type: nvidia, amd, or cpu")
    return parser.parse_args()

async def monitor_resources(stop_event, stats_result, runtime_type="nvidia"):
    cpu_records, mem_records = [], []
    gpu_util_records, vram_mib_records = [], []

    while not stop_event.is_set():
        try:
            # CPU & Sys Mem
            proc_top = await asyncio.create_subprocess_shell(
                "top -b -n 1", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
            )
            stdout_top, _ = await proc_top.communicate()
            top_out = stdout_top.decode()
            curr_cpu, curr_mem = None, None
            for line in top_out.split('\n'):
                if 'Cpu(s)' in line:
                    m = re.search(r'([\d.]+)\s+id', line)
                    if m: curr_cpu = 100.0 - float(m.group(1))
                elif 'Mem' in line and 'total' in line:
                    m_t = re.search(r'([\d.]+)\s+total', line)
                    m_u = re.search(r'([\d.]+)\s+used', line)
                    if m_t and m_u: curr_mem = (float(m_u.group(1)) / float(m_t.group(1))) * 100.0

            # GPU & VRAM
            if runtime_type == "nvidia":
                proc_smi = await asyncio.create_subprocess_shell(
                    "nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
                )
                stdout_smi, _ = await proc_smi.communicate()
                smi_lines = stdout_smi.decode().strip().split('\n')
                if smi_lines and smi_lines[0]:
                    g_utils = [float(line.split(',')[0]) for line in smi_lines if line.strip()]
                    v_used = [float(line.split(',')[1]) for line in smi_lines if line.strip()]
                    avg_gpu = sum(g_utils) / len(g_utils)
                    if avg_gpu >= 50.0:  # Only record during active inference, ignore idle
                        gpu_util_records.append(avg_gpu)
                        vram_mib_records.append(sum(v_used))
                        if curr_cpu: cpu_records.append(curr_cpu)
                        if curr_mem: mem_records.append(curr_mem)
            elif runtime_type == "amd":
                # Basic rocm-smi parsing
                proc_smi = await asyncio.create_subprocess_shell(
                    "rocm-smi --showuse --showmeminfo vram --json",
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
                )
                stdout_smi, _ = await proc_smi.communicate()
                try:
                    data = json.loads(stdout_smi.decode())
                    g_utils, v_used = [], []
                    for k, v in data.items():
                        if k.startswith('card'):
                            if 'GPU use (%)' in v: g_utils.append(float(v['GPU use (%)']))
                            if 'VRAM Total Used (B)' in v: v_used.append(float(v['VRAM Total Used (B)']) / 1024 / 1024)
                    if g_utils: gpu_util_records.append(sum(g_utils) / len(g_utils))
                    if v_used: vram_mib_records.append(sum(v_used))
                except: pass

            if curr_cpu: cpu_records.append(curr_cpu)
            if curr_mem: mem_records.append(curr_mem)
        except: pass
        await asyncio.sleep(0.5)

    stats_result['cpu'] = sum(cpu_records)/len(cpu_records) if cpu_records else 0
    stats_result['gpu'] = sum(gpu_util_records)/len(gpu_util_records) if gpu_util_records else 0
    stats_result['vram'] = sum(vram_mib_records)/len(vram_mib_records) if vram_mib_records else 0
    stats_result['mem'] = sum(mem_records)/len(mem_records) if mem_records else 0

async def fetch_chat(client, model_name, prompt):
    start = time.time()
    first_token_time = None
    token_count = 0
    try:
        response = await client.chat.completions.create(
            model=model_name, messages=[{"role": "user", "content": prompt}],
            stream=True, max_tokens=500, stream_options={"include_usage": True}
        )
        async for chunk in response:
            if first_token_time is None and chunk.choices and chunk.choices[0].delta.content:
                first_token_time = time.time()
            if chunk.usage: token_count = chunk.usage.completion_tokens

        dur = time.time() - start
        ttft = first_token_time - start if first_token_time else 0
        return {"success": True, "tps": token_count/dur if dur > 0 else 0, "ttft": ttft, "dur": dur, "tokens": token_count}
    except Exception as e:
        import sys
        print(f"[fetch_chat ERROR] {type(e).__name__}: {e}", file=sys.stderr)
        return {"success": False, "tps": 0, "ttft": 0, "dur": 0, "tokens": 0, "error": str(e)}

async def run_test(client, model_name, concurrency, base_prompts, runtime_type):
    prompts = [base_prompts[i % len(base_prompts)] for i in range(concurrency)]
    stop_event = asyncio.Event()
    sys_stats = {}
    monitor_task = asyncio.create_task(monitor_resources(stop_event, sys_stats, runtime_type))

    start_time = time.time()
    results = await asyncio.gather(*(fetch_chat(client, model_name, p) for p in prompts))
    total_dur = time.time() - start_time

    stop_event.set()
    await monitor_task

    success = [r for r in results if r["success"]]
    if not success: return None

    total_tokens = sum(r.get("tokens", 0) for r in success)

    return {
        "concurrency": concurrency,
        "system_tps": (len(success) * 500) / total_dur if total_dur > 0 else 0,
        "avg_tps": sum(r["tps"] for r in success) / len(success),
        "avg_ttft": sum(r["ttft"] for r in success) / len(success),
        "avg_dur": sum(r["dur"] for r in success) / len(success),
        **sys_stats
    }

def draw_final_report(report, model_name, cpu_info, gpu_info, os_info, output_dir):
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"benchmark_{timestamp}.png"
    filepath = os.path.join(output_dir, filename)

    labels = [str(r['concurrency']) for r in report]
    sys_tps = [round(r['system_tps'], 2) for r in report]
    avg_tps = [round(r['avg_tps'], 2) for r in report]
    ttft = [round(r['avg_ttft'], 3) for r in report]
    gpu_util = [round(r['gpu'], 1) for r in report]
    cpu_util = [round(r['cpu'], 1) for r in report]
    vram = [round(r['vram'], 1) for r in report]

    fig = plt.figure(figsize=(14, 11))
    gs = gridspec.GridSpec(2, 1, height_ratios=[2.5, 1])

    ax1 = fig.add_subplot(gs[0])
    main_title = f"Benchmark: {model_name} (500 Tokens/Req)"
    subtitle_cpu = f"CPU: {cpu_info}"
    subtitle_gpu_os = f"GPU: {gpu_info} | OS: {os_info}"
    
    full_title = f"{main_title}\n{subtitle_cpu}\n{subtitle_gpu_os}"
    ax1.set_title(full_title, fontsize=13, pad=35, fontweight='bold')

    ax1.set_ylabel('TPS (Tokens/s)', color='#1f77b4', fontsize=12, fontweight='bold')
    lns1 = ax1.plot(labels, sys_tps, marker='o', color='#1f77b4', linewidth=3, label='System Total TPS')
    lns2 = ax1.plot(labels, avg_tps, marker='s', color='#17becf', linestyle='--', label='Avg Stream TPS')
    ax1.tick_params(axis='y', labelcolor='#1f77b4')
    ax1.grid(True, alpha=0.2)

    ax2 = ax1.twinx()
    ax2.set_ylabel('Utilization (%)', color='#ff7f0e', fontsize=12, fontweight='bold')
    lns3 = ax2.plot(labels, gpu_util, marker='x', color='#ff7f0e', linewidth=2, label='Avg GPU Util %')
    lns4 = ax2.plot(labels, cpu_util, marker='^', color='#d62728', linestyle=':', label='Avg CPU Util %')
    ax2.tick_params(axis='y', labelcolor='#ff7f0e')
    ax2.set_ylim(0, 110)

    ax3 = ax1.twinx()
    ax3.spines['right'].set_position(('outward', 65))
    lns5 = ax3.bar(labels, vram, alpha=0.15, color='#bcbd22', label='Total VRAM (MiB)')
    ax3.set_ylabel('VRAM (MiB)', color='#8c564b', fontsize=12, fontweight='bold')
    ax3.tick_params(axis='y', labelcolor='#8c564b')
    ax3.set_ylim(0, max(vram) * 1.3 if vram else 1000)

    all_lns = lns1 + lns2 + lns3 + lns4
    labs = [l.get_label() for l in all_lns]
    ax1.legend(all_lns, labs, loc='upper left', frameon=True, fontsize=10, shadow=True)

    ax_table = fig.add_subplot(gs[1])
    ax_table.axis('off')

    header = ["Concurrency (N)", "System TPS", "Avg TPS", "TTFT (s)", "CPU %", "GPU %", "VRAM (MiB)"]
    table_data = []
    for r in report:
        table_data.append([
            r['concurrency'], f"{r['system_tps']:.2f}", f"{r['avg_tps']:.2f}",
            f"{r['avg_ttft']:.3f}", f"{r['cpu']:.1f}", f"{r['gpu']:.1f}", f"{r['vram']:.1f}"
        ])

    table = ax_table.table(cellText=table_data, colLabels=header, loc='center', cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1.0, 2.2)

    for (row, col), cell in table.get_celld().items():
        if row == 0:
            cell.set_text_props(fontweight='bold', color='white')
            cell.set_facecolor('#333333')

    plt.tight_layout()
    # Ensure there is enough space for the title
    plt.subplots_adjust(top=0.88)
    plt.savefig(filepath, dpi=150)
    return filename

async def main():
    args = parse_args()
    client = AsyncOpenAI(base_url=args.base_url, api_key=args.api_key)
    
    if args.prompts:
        base_prompts = json.loads(args.prompts)
    else:
        base_prompts = ["Tell me about yourself in 1000 words."]

    runtime_type = args.runtime_type
    
    # Levels to test: 1, 2, 4, 8, 16 up to requested concurrency
    levels = [l for l in [1, 2, 4, 8, 16] if l <= args.concurrency]
    if args.concurrency not in levels:
        levels.append(args.concurrency)
    levels.sort()

    report_data = []
    for c in levels:
        res = await run_test(client, args.model_name, c, base_prompts, runtime_type)
        if res:
            report_data.append(res)
            # Print intermediate result for real-time frontend update
            print(json.dumps({
                "type": "incremental_result",
                "data": res
            }), flush=True)
        if c != levels[-1]:
            await asyncio.sleep(2)

    if report_data:
        img_file = draw_final_report(report_data, args.model_name, args.cpu_info, args.gpu_info, args.os_info, args.output_dir)
        print(json.dumps({
            "status": "success",
            "image": img_file,
            "report": report_data
        }), flush=True)
    else:
        print(json.dumps({"status": "error", "message": "No successful requests"}))

if __name__ == "__main__":
    asyncio.run(main())
