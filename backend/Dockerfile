FROM golang:1.21-alpine

# tzdata + фиксированный пояс: created_at пишется в местном времени, а SQL
# сравнивает через date(...,'localtime') — иначе продажи у полуночи попадали не в тот день.
RUN apk add --no-cache gcc musl-dev tzdata
ENV TZ=Europe/Moscow

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN mkdir -p /app/data
RUN CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o server .

CMD ["./server"]
