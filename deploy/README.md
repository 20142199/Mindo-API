# Deploy Mindo với Cloudflare và origin HTTP

Hai hostname công khai:

- Admin: `https://admin-mindo.stg-studio.com`
- API: `https://api-mindo.stg-studio.com`

Cloudflare nhận HTTPS từ trình duyệt và kết nối tới origin qua HTTP cổng 80. Nginx tại origin định tuyến theo hostname; origin không redirect sang HTTPS để tránh vòng lặp khi dùng Flexible mode.

## 1. Cloudflare

Tạo hai bản ghi DNS dạng `A` trỏ tới IPv4 của máy chủ và bật Proxy (đám mây màu cam):

- `admin-mindo` → IP origin
- `api-mindo` → IP origin

Trong SSL/TLS của zone, chọn `Flexible` nếu origin thực sự chỉ mở HTTP. Bật `Always Use HTTPS` tại Cloudflare Edge để người dùng luôn truy cập HTTPS.

Không tạo redirect HTTP → HTTPS ở Nginx origin khi đang dùng Flexible.

## 2. Biến môi trường

```bash
cp deploy/.env.production.example deploy/.env.production
```

Thay toàn bộ password/secret mẫu. `POSTGRES_PASSWORD` nếu có ký tự đặc biệt phải được URL-encode tương ứng trong `DATABASE_URL`.

Các URL domain đã được cố định trong compose:

- `APP_URL=https://api-mindo.stg-studio.com`
- `CORS_ORIGINS=https://admin-mindo.stg-studio.com`
- Admin build với `VITE_API_URL=https://api-mindo.stg-studio.com`

## 3. Khởi động

```bash
docker compose --env-file deploy/.env.production -f docker-compose.production.yml up -d --build
```

Chỉ gateway Nginx publish cổng `80`. PostgreSQL, Redis, API và web Admin chỉ nằm trong Docker network.

Kiểm tra:

```bash
curl -H 'Host: api-mindo.stg-studio.com' http://127.0.0.1/health
curl -I -H 'Host: admin-mindo.stg-studio.com' http://127.0.0.1/
```

Sau khi DNS hoạt động:

```bash
curl https://api-mindo.stg-studio.com/health
curl -I https://admin-mindo.stg-studio.com/
```

## 4. Cập nhật phiên bản

```bash
git pull
docker compose --env-file deploy/.env.production -f docker-compose.production.yml up -d --build
```

API tự chạy Prisma migration trước khi khởi động. Không tự chạy seed trên production.

## Lưu ý bảo mật

Flexible chỉ mã hóa từ người dùng đến Cloudflare; đoạn Cloudflare → origin vẫn là HTTP. Với hệ thống có đăng nhập và eKYC, nên chuyển sang Full (strict) cùng Cloudflare Origin Certificate khi có thể, đồng thời giới hạn firewall origin chỉ nhận traffic từ Cloudflare.
