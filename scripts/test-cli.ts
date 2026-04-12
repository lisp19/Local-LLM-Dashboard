import { getDashboardData } from '../lib/systemMetrics';

async function main() {
  const data = await getDashboardData();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
