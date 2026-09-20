server {
  listen 80;
  listen [::]:80;
  server_name api-mindo.stg-studio.com;

  client_max_body_size 12m;

  location / {
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
  }
}
