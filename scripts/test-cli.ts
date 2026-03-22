import { getDashboardData } from '../lib/systemMetrics';

async function main() {
  console.log('Fetching dashboard data...');
  try {
    const data = await getDashboardData();
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

main();
