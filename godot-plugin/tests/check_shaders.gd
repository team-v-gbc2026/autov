extends SceneTree

func _initialize() -> void:
	var failed := false
	for path in ["res://addons/autov_avfx/shaders/particle.gdshader", "res://addons/autov_avfx/shaders/surface.gdshader"]:
		var shader := load(path) as Shader
		var uniforms := shader.get_shader_uniform_list()
		print(path, ": ", uniforms.size(), " uniforms")
		if uniforms.is_empty(): failed = true
	quit(1 if failed else 0)
