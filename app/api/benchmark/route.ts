import { NextRequest } from 'next/server';
import { loadAppConfig } from '../../../lib/appConfig';

export async function POST(req: NextRequest) {
  try {
    const config = await loadAppConfig();
    const { port, model, prompt, enableThinking } = await req.json();

    if (!port || !model) {
      return new Response(JSON.stringify({ error: "Missing port or model parameters" }), { status: 400 });
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    let targetModel = model;

    // Auto-discover exactly what model name the container expects
    try {
      const modelsRes = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${config.vllmApiKey}` }
      });
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        if (modelsData?.data?.length > 0) {
          targetModel = modelsData.data[0].id;
        }
      }
    } catch {
      // Ignore if /v1/models is not supported
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      model: targetModel,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    };
    
    // Inject extra kwargs if disable thinking is chosen
    if (enableThinking === false) {
      payload.chat_template_kwargs = {
        enable_thinking: false
      };
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.vllmApiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        return new Response(`Error ${response.status} from container:\n${await response.text()}`, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      }
    });

  } catch (error: Error | unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
