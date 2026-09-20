server {
  listen 80;
  listen [::]:80;
  server_name admin-mindo.stg-studio.com;

  location / {
    proxy_pass http://127.0.0.1:4011;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
  }
}
