find . -type d \( \
  -name "node_modules" -o \
  -name ".turbo" -o \
  -name "dist" -o \
  -name ".next" \
\) -prune -exec rm -rf {} +

rm -rf packages/database/src/generated