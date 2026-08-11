import "fake-indexeddb/auto";
import { runHomeDataBenchmark } from "../tests/support/homeDataBenchmark";

const report = await runHomeDataBenchmark();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
