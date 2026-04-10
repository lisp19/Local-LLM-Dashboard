import http from 'http';

async function runTests() {
  console.log('Testing /api/docker endpoint...');
  const res = await fetch('http://localhost:3000/api/docker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inspect', containerId: 'invalid-id' })
  });
  
  if (res.status === 404) {
    console.error('FAIL: Endpoint not found');
    process.exit(1);
  }
  
  const data = await res.json();
  if (data.error) {
    console.log('PASS: Endpoint exists and handled error correctly.');
  } else {
    console.error('FAIL: Expected an error for invalid container ID');
    process.exit(1);
  }
}

runTests().catch(console.error);