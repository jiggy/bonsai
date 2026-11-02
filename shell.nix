{
  pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/9bb52223f4f6a0cc606fd0852d8784f896c137d5.tar.gz";
  }) { },
}:
# { pkgs ? import <nixpkgs> {} }:

pkgs.mkShellNoCC {
  packages =  with pkgs; [
    ncurses
    git
    bun
    just
    # nodejs_24
    curl
    jq
    ripgrep
    coreutils
  ];
}
