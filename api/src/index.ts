import { appLogger } from "./utils/logger";
import "dotenv/config";
import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  appLogger.info(`ASG Card API listening on http://localhost:${env.PORT}`);
});
