import { loadModelConfig } from '../lib/appConfig';

async function test() {
    console.log('CWD:', process.cwd());
    const config = await loadModelConfig();
    console.log('Config Keys:', Object.keys(config));
    console.log('Sample Key (glm-cpu):', JSON.stringify(config['glm-cpu'], null, 2));
}

test();
