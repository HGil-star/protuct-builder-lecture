FROM node:24-bookworm-slim
WORKDIR /app/dwg-service
COPY dwg-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY dwg-service/*.js ./
COPY dwg-pdf.html dwg-pdf.css dwg-pdf.js dwg-pdf-config.js /app/
COPY index.html style.css script.js ui.css common.css receipt.html receipt.css receipt.js cutout.html cutout.js imagekit.js /app/
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
