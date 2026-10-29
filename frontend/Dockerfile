# ServiceSetu web
#
# Builds the app, then serves the result from nginx. The runtime image contains
# static files and a config - no Node, no node_modules, nothing that can be
# exploited as a running process.

# ---------------------------------------------------------------- build
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at build time, so this is a build argument
# rather than a runtime environment variable. The default is relative on
# purpose: it keeps the app and the API on one origin behind nginx, which is
# what lets the HttpOnly refresh cookie work without CORS.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# -------------------------------------------------------------- serve
FROM nginx:1.27-alpine AS serve

# Replaces the default site rather than adding to it, so there is no leftover
# server block answering on the same port.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/servicesetu.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
