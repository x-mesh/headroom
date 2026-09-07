# 빌드 단계가 없다. 브라우저가 쓰는 것을 그대로 담고, 그것만 담는다.
# 마운트가 아니라 COPY 인 이유는 이미지 태그가 곧 배포 단위여야 하기 때문이다 —
# 마운트하면 컨테이너 내용이 호스트 작업 트리를 따라가 재현할 수 없다.
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/index.html || exit 1
