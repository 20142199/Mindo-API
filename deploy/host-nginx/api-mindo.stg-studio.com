# Nginx của HOST cho API Mindo (chế độ "server đã có Nginx trên cổng 80").
#
# Container API nghe ở 127.0.0.1:4010; chỉ Nginx hệ thống nhận traffic Internet.

# Socket.IO cần nâng cấp kết nối lên WebSocket, và `Connection` PHẢI theo đúng
# request: `upgrade` khi client xin nâng cấp, `close` khi không. Đặt cứng
# `Connection "upgrade"` cho mọi request sẽ làm hỏng nhánh long-polling.
#
# Tên có tiền tố `mindo_` để không đụng map cùng tên của website khác trên cùng
# host — `map` nằm ở tầng http, và trùng tên là Nginx từ chối nạp cấu hình.
map $http_upgrade $mindo_connection_upgrade {
  default upgrade;
  ""      close;
}

server {
  listen 80;
  listen [::]:80;
  server_name api-mindo.stg-studio.com;

  client_max_body_size 12m;

  # PHẢI có block riêng cho Socket.IO, kèm hai header Upgrade.
  #
  # Thiếu nó thì app IM LẶNG mất hết realtime mà không báo lỗi gì: REST vẫn
  # chạy hoàn hảo — đăng nhập được, danh sách tin nhắn tải được — nên trông
  # như mọi thứ đều ổn, trong khi tin nhắn không tới, trạng thái online sai, và
  # CUỘC GỌI KHÔNG ĐỔ CHUÔNG vì tín hiệu gọi đi qua socket.
  #
  # Bình thường socket.io thiếu Upgrade sẽ tụt về long-polling nên vẫn sống.
  # Ở đây KHÔNG có đường lùi đó: app khai `transports: ['websocket']`
  # (Mindo-App/src/services/chatSocket.ts), nên hỏng bắt tay là hỏng hẳn.
  #
  # Lưu ý: `/socket.io/` là đường truyền, không phải namespace. Namespace
  # `/chat` mà app nối tới đi BÊN TRONG đường này, không phải một location
  # riêng — thêm `location /chat` là sai hướng.
  location /socket.io/ {
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $mindo_connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
  }

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
