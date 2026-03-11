FROM node:22-slim

WORKDIR /app

# Install pino and dotenv (external deps not bundled by esbuild)
COPY package.json ./
RUN npm install --omit=dev

# Copy the esbuild CJS bundle (all app code + deps inlined)
COPY bundle.cjs ./

EXPOSE 4022

ENV NODE_ENV=production
ENV PORT=4022

CMD ["node", "bundle.cjs"]
