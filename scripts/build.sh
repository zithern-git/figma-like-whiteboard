#!/bin/bash

# build.sh - 构建前端生产包 + 编译后端 TypeScript

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Figma-like Whiteboard 构建脚本       ${NC}"
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

echo -e "\n${YELLOW}[1/3] 检查依赖...${NC}"
check_dependency node
check_dependency npm
echo -e "${GREEN}✓ Node.js 和 npm 已安装${NC}"

# 构建服务端
echo -e "\n${YELLOW}[2/3] 构建服务端...${NC}"
cd "$PROJECT_ROOT/server"

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo -e "${CYAN}安装服务端依赖...${NC}"
  npm ci
fi

# 清理旧构建
echo -e "${CYAN}清理旧构建...${NC}"
rm -rf dist

# 编译 TypeScript
echo -e "${CYAN}编译 TypeScript...${NC}"
npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}✗ 服务端构建失败${NC}"
  exit 1
fi

echo -e "${GREEN}✓ 服务端构建成功${NC}"

# 构建客户端
echo -e "\n${YELLOW}[3/3] 构建客户端...${NC}"
cd "$PROJECT_ROOT/client"

# 安装依赖
if [ ! -d "node_modules" ]; then
  echo -e "${CYAN}安装客户端依赖...${NC}"
  npm ci
fi

# 清理旧构建
echo -e "${CYAN}清理旧构建...${NC}"
rm -rf dist

# 构建生产包
echo -e "${CYAN}构建生产包...${NC}"
npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}✗ 客户端构建失败${NC}"
  exit 1
fi

echo -e "${GREEN}✓ 客户端构建成功${NC}"

# 汇总
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  构建完成!                             ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${CYAN}服务端输出: server/dist/${NC}"
echo -e "${CYAN}客户端输出: client/dist/${NC}"
echo -e "\n${YELLOW}下一步: 运行 scripts/deploy.sh 进行部署${NC}"
