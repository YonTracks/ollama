# Idempotent patch applier used by compat.cmake.
#
# Invocation (from a CMake PATCH_COMMAND):
#   cmake -DPATCH_DIR=<dir of *.patch> -P apply-patch.cmake
#
# Every *.patch under PATCH_DIR is applied in the current working directory
# (which ExternalProject / FetchContent sets to the fetched source's
# SOURCE_DIR). A patch already applied — detected via `git apply --reverse
# --check` — is skipped. This makes re-configuring and re-building safe.

if(NOT DEFINED PATCH_DIR)
    message(FATAL_ERROR "apply-patch.cmake: PATCH_DIR not set")
endif()

find_package(Git QUIET REQUIRED)

get_filename_component(_patch_workdir "." ABSOLUTE)
get_filename_component(_git_ceiling "${_patch_workdir}" DIRECTORY)
set(_git_apply_env GIT_CEILING_DIRECTORIES=${_git_ceiling})

file(GLOB_RECURSE _patches "${PATCH_DIR}/*.patch")
list(SORT _patches)

# Fetched sources can keep old patch edits after a llama.cpp pin bump. Only
# reset when a patch is neither already applied nor cleanly applicable, which
# indicates a stale or partially patched checkout.
if(RESET_SOURCE)
    set(_reset_source OFF)
    foreach(PATCH_FILE IN LISTS _patches)
        execute_process(
            COMMAND ${CMAKE_COMMAND} -E env ${_git_apply_env}
                ${GIT_EXECUTABLE} apply --reverse --check "${PATCH_FILE}"
            RESULT_VARIABLE _reverse_check
            OUTPUT_QUIET ERROR_QUIET
        )
        if(_reverse_check EQUAL 0)
            continue()
        endif()

        execute_process(
            COMMAND ${CMAKE_COMMAND} -E env ${_git_apply_env}
                ${GIT_EXECUTABLE} apply --check --whitespace=nowarn "${PATCH_FILE}"
            RESULT_VARIABLE _forward_check
            OUTPUT_QUIET ERROR_QUIET
        )
        if(_forward_check EQUAL 0)
            continue()
        endif()

        set(_reset_source ON)
        message(STATUS "llama/compat: stale patch state detected for ${PATCH_FILE}")
        break()
    endforeach()

    if(_reset_source)
        execute_process(
            COMMAND ${CMAKE_COMMAND} -E env ${_git_apply_env}
                ${GIT_EXECUTABLE} reset --hard HEAD
            RESULT_VARIABLE _reset_result
            OUTPUT_QUIET
        )
        if(NOT _reset_result EQUAL 0)
            message(FATAL_ERROR
                "llama/compat: failed to reset fetched source before applying patches")
        endif()
        message(STATUS "llama/compat: reset fetched source before applying patches")
    endif()
endif()

foreach(PATCH_FILE IN LISTS _patches)
    # If the patch can be REVERSED cleanly, it's already applied. Skip.
    execute_process(
        COMMAND ${CMAKE_COMMAND} -E env ${_git_apply_env}
            ${GIT_EXECUTABLE} apply --reverse --check "${PATCH_FILE}"
        RESULT_VARIABLE _reverse_check
        OUTPUT_QUIET ERROR_QUIET
    )
    if(_reverse_check EQUAL 0)
        message(STATUS "llama/compat: patch already applied, skipping")
        continue()
    endif()

    # Otherwise, apply forward.
    execute_process(
        COMMAND ${CMAKE_COMMAND} -E env ${_git_apply_env}
            ${GIT_EXECUTABLE} apply --whitespace=nowarn "${PATCH_FILE}"
        RESULT_VARIABLE _apply_result
    )
    if(NOT _apply_result EQUAL 0)
        message(FATAL_ERROR
            "llama/compat: failed to apply ${PATCH_FILE}\n"
            "This usually means the pinned llama.cpp source has changed. "
            "Regenerate the patch against the pinned LLAMA_CPP_VERSION and retry.")
    endif()

    message(STATUS "llama/compat: applied patch")
endforeach()
