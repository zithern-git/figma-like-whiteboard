#!/bin/bash

# deploy.sh - 自动化部署脚本（Docker 构建 + 推送 + 部署）

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
IMAGE_NAME="${IMAGE_NAME:-figma-whiteboard}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Figma-like Whiteboard 部署脚本       ${NC}"
echo -e "${CYAN}========================================${NC}"

# 获取项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 检查依赖
check_dependency() {
  if ! command -v $1 &> /dev/null; then
    echo -e "${RED}错误: $1 未安装${NC}"
    exit 1
  fi
}

echo -e "\n${YELLOW}[1/5] 检查依赖...${NC}"
check_dependency docker
check_dependency docker-compose
echo -e "${GREEN}✓ Docker 和 docker-compose 已安装${NC}"

# 检查必要文件
echo -e "\n${YELLOW}[2/5] 检查必要文件...${NC}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo -e "${RED}错误: $COMPOSE_FILE 不存在${NC}"
  echo -e "${YELLOW}请确保 docker-compose.yml 位于项目根目录${NC}"
  exit 1
fi

if [ ! -f "server/Dockerfile" ]; then
  echo -e "${RED}错误: server/Dockerfile 不存在${NC}"
  exit 1
fi

if [ ! -d "client/dist" ]; then
  echo -e "${YELLOW}警告: client/dist 不存在，先执行构建...${NC}"
  bash "$PROJECT_ROOT/scripts/build.sh"
fi

echo -e "${GREEN}✓ 文件检查完成${NC}"

# 构建 Docker 镜像
echo -e "\n${YELLOW}[3/5] 构建 Docker 镜像...${NC}"

# 构建服务端镜像
SERVER_IMAGE="$IMAGE_NAME-server:$IMAGE_TAG"
echo -e "${CYAN}构建服务端镜像: $SERVER_IMAGE${NC}"
docker build -t "$SERVER_IMAGE" -f server/Dockerfile server/

# 构建 Nginx 镜像（包含前端静态文件）
NGINX_IMAGE="$IMAGE_NAME-nginx:$IMAGE_TAG"
echo -e "${CYAN}构建 Nginx 镜像: $NGINX_IMAGE${NC}"
docker build -t "$NGINX_IMAGE" -f nginx/Dockerfile . || {
  # 如果没有 nginx/Dockerfile，使用 docker-compose 构建
  echo -e "${YELLOW}未找到 nginx/Dockerfile，使用 docker-compose 构建...${NC}"
}

echo -e "${GREEN}✓ Docker 镜像构建完成${NC}"

# 推送镜像（可选）
echo -e "\n${YELLOW}[4/5] 推送镜像...${NC}"

if [ -n "$DOCKER_REGISTRY" ]; then
  echo -e "${CYAN}推送到镜像仓库: $DOCKER_REGISTRY${NC}"

  # 标记镜像
  docker tag "$SERVER_IMAGE" "$DOCKER_REGISTRY/$SERVER_IMAGE"
  docker tag "$NGINX_IMAGE" "$DOCKER_REGISTRY/$NGINX_IMAGE"

  # 推送
  docker push "$DOCKER_REGISTRY/$SERVER_IMAGE"
  docker push "$DOCKER_REGISTRY/$NGINX_IMAGE"

  echo -e "${GREEN}✓ 镜像推送完成${NC}"
else
  echo -e "${YELLOW}未配置 DOCKER_REGISTRY，跳过推送${NC}"
fi

# 部署
echo -e "\n${YELLOW}[5/5] 部署服务...${NC}"

# 停止旧服务
echo -e "${CYAN}停止旧服务...${NC}"
docker-compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# 启动新服务
echo -e "${CYAN}启动新服务...${NC}"
docker-compose -f "$COMPOSE_FILE" up -d

# 等待服务启动
echo -e "${CYAN}等待服务启动...${NC}"
sleep 5

# 健康检查
echo -e "${CYAN}健康检查...${NC}"
if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ 后端服务健康${NC}"
else
  echo -e "${YELLOW}⚠ 后端服务可能未就绪，请检查日志${NC}"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  部署完成!                             ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${CYAN}前端地址: http://localhost${NC}"
echo -e "${CYAN}后端地址: http://localhost:3001${NC}"
echo -e "\n${YELLOW}查看日志: docker-compose -f $COMPOSE_FILE logs -f${NC}"
echo -e "${YELLOW}停止服务: docker-compose -f $COMPOSE_FILE down${NC}"
