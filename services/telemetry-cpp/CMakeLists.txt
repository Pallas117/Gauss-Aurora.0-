cmake_minimum_required(VERSION 3.16)
project(telemetry-cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)

find_package(PkgConfig REQUIRED)
pkg_check_modules(RDKAFKA REQUIRED rdkafka)
pkg_check_modules(LIBCURL REQUIRED libcurl)

add_executable(telemetry-cpp src/main.cpp)
target_include_directories(telemetry-cpp PRIVATE ${RDKAFKA_INCLUDE_DIRS})
target_link_libraries(telemetry-cpp ${RDKAFKA_LIBRARIES} ${LIBCURL_LIBRARIES})
