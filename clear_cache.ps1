Get-ChildItem -Path . -Include node_modules,.turbo,dist,.next -Recurse -Directory -Force | Remove-Item -Recurse -Force

Remove-Item -Path packages/database/src/generated -Recurse -Force -ErrorAction SilentlyContinue
