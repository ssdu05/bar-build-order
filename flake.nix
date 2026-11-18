{
  description = "Development environment for BAR Build Order Library";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.uv
              pkgs.python313
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.sqlite
              pkgs.lua
            ];

            # Use Nix's Python rather than downloading an unpatched interpreter.
            UV_PYTHON = "${pkgs.python313}/bin/python3";
            UV_PYTHON_DOWNLOADS = "never";

            # Downloaded pnpm binaries cannot run unpatched on NixOS.
            npm_config_manage_package_manager_versions = "false";
          };
        });
    };
}
