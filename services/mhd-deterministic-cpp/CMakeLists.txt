cmake_minimum_required(VERSION 3.16)
project(gauss_mhd_fixture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(gauss_mhd_fixture STATIC
  src/gauss_mhd_fixture.cpp
)
target_include_directories(gauss_mhd_fixture PUBLIC include)
target_compile_options(gauss_mhd_fixture PRIVATE -Wall -Wextra -Wpedantic)

add_executable(gauss-mhd-fixture src/main.cpp)
target_link_libraries(gauss-mhd-fixture PRIVATE gauss_mhd_fixture)
target_compile_options(gauss-mhd-fixture PRIVATE -Wall -Wextra -Wpedantic)

enable_testing()
add_test(NAME gauss_mhd_fixture_self_test COMMAND gauss-mhd-fixture --self-test)
