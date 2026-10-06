import { configuracaoEslint } from "plataforma-kit/eslint";

export default configuracaoEslint({
  react: ["web/src/**/*.tsx", "web/testes/**/*.tsx"],
  ignorar: ["dist/**", "dist-pacote/**", "web/dist/**", "dados/**", "**/node_modules/**"],
});
