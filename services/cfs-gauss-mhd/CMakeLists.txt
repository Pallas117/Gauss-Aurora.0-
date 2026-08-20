cmake_minimum_required(VERSION 3.16)
project(gauss_cfs_mhd C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

add_library(gauss_cfs_mhd STATIC src/gauss_mhd_app.c)
target_include_directories(gauss_cfs_mhd PUBLIC include)
target_compile_options(gauss_cfs_mhd PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_executable(gauss_cfs_mhd_sil src/main.c)
target_link_libraries(gauss_cfs_mhd_sil PRIVATE gauss_cfs_mhd)
target_compile_options(gauss_cfs_mhd_sil PRIVATE -Wall -Wextra -Wpedantic -Werror)

enable_testing()
add_test(NAME gauss_cfs_mhd_self_test COMMAND gauss_cfs_mhd_sil --self-test)
