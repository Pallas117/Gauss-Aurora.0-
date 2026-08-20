cmake_minimum_required(VERSION 3.16)
project(gauss_physics LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)

include(FetchContent)
FetchContent_Declare(
  sgp4
  GIT_REPOSITORY https://github.com/dnwrnr/sgp4
)
FetchContent_MakeAvailable(sgp4)

# Using a dummy cpp target until the SGP4Propagator headers are mapped
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/sgp4_dummy.cpp "")

add_library(gauss_physics SHARED ${CMAKE_CURRENT_BINARY_DIR}/sgp4_dummy.cpp)
target_include_directories(gauss_physics PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(gauss_physics PUBLIC sgp4)
