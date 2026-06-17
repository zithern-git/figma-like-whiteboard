#!/bin/bash

# dev.sh - 一键启动开发环境
# 启动 MongoDB + Redis + 后端 + 前端

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Figma-like Whiteboard 开发环境启动   ${NC}"
echo -e "${CYAN}========================================${NC}"

# 检查依赖
check_dependency() {
  if ! command -v $1 &> /dev/null; then
    echo -e "${RED}错误: $1 未安装${NC}"
    exit 1
  fi
}

echo -e "\n${YELLOW}[1/4] 检查依赖...${NC}"
check_dependency node
check_dependency npm
check_dependency mongod
check_dependency redis-server

echo -e "${GREEN}✓ 所有依赖已安装${NC}"

# 启动 MongoDB
echo -e "\n${YELLOW}[2/4] 启动 MongoDB...${NC}"
if pgrep -x "mongod" > /dev/null; then
  echo -e "${GREEN}✓ MongoDB 已在运行${NC}"
else
  mongod --dbpath ./data/db --fork --logpath ./data/mongodb.log 2>/dev/null || true
  if [ -f ./data/mongodb.log ]; then
    echo -e "${GREEN}✓ MongoDB 启动成功${NC}"
  else
    mkdir -p ./data/db
    mongod --dbpath ./data/db --fork --logpath ./data/mongodb.log
    echo -e "${GREEN}✓ MongoDB 启动成功${NC}"
  fi
fi

# 启动 Redis
echo -e "\n${YELLOW}[3/4] 启动 Redis...${NC}"
if pgrep -x "redis-server" > /dev/null; then
  echo -e "${GREEN}✓ Redis 已在运行${NC}"
else
  redis-server --daemonize yes
  echo -e "${GREEN}✓ Redis 启动成功${NC}"
fi

# 安装依赖（如果需要）
echo -e "\n${YELLOW}[4/4] 检查并安装依赖...${NC}"

if [ ! -d "server/node_modules" ]; then
  echo -e "${CYAN}安装服务端依赖...${NC}"
  cd server && npm install && cd ..
fi

if [ ! -d "client/node_modules" ]; then
  echo -e "${CYAN}安装客户端依赖...${NC}"
  cd client && npm install && cd ..
fi

echo -e "${GREEN}✓ 依赖检查完成${NC}"

# 启动后端和前端
echo -e "\n${CYAN}========================================${NC}"
echo -e "${CYAN}  启动服务...                           ${NC}"
echo -e "${CYAN}========================================${NC}"

# 使用 trap 确保退出时清理
cleanup() {
  echo -e "\n${YELLOW}正在停止服务...${NC}"
  kill $SERVER_PID $CLIENT_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# 启动后端
cd server
echo -e "${CYAN}启动后端 (http://localhost:3001)...${NC}"
npm run dev &
SERVER_PID=$!
cd ..

# 等待后端启动
sleep 3

# 启动前端
cd client
echo -e "${CYAN}启动前端 (http://localhost:5173)...${NC}"
npm run dev &
CLIENT_PID=$!
cd ..

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  所有服务已启动!                       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${CYAN}前端地址: http://localhost:5173${NC}"
echo -e "${CYAN}后端地址: http://localhost:3001${NC}"
echo -e "${CYAN}API 文档: http://localhost:3001/api/health${NC}"
echo -e "\n${YELLOW}按 Ctrl+C 停止所有服务${NC}"

# 等待进程
wait $SERVER_PID $CLIENT_PID
