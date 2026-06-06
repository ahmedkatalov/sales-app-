FROM golang:1.21-alpine

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN mkdir -p /app/data
RUN go build -o server .

CMD ["./server"]